import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { AppConfig } from '../config';
import { Db } from '../db/db';
import { Actor } from '../common/actor';
import { AppError } from '../common/errors';
import { audit } from '../common/audit';

export const SESSION_COOKIE = 'madar_session';
export const OIDC_COOKIE = 'madar_oidc';
const SESSION_HOURS = 8;

const b64url = (b: Buffer) => b.toString('base64url');

/**
 * تسجيل الدخول بحساب الجهة عبر OIDC (Authorization Code + PKCE).
 * SAML يحتاج مكتبة وتهيئة خاصة بكل جهة ولم يُفعَّل في هذه النسخة.
 * نفاذ يتحقق من الهوية فقط؛ بيانات الوظيفة والمقر تأتي من الموارد البشرية للجهة.
 */
export class AuthService {
  private readonly secret: Uint8Array;
  private discovery?: Promise<any>;

  constructor(private readonly db: Db, private readonly cfg: AppConfig) {
    this.secret = new TextEncoder().encode(cfg.jwtSecret);
  }

  async issueSession(employeeId: string): Promise<string> {
    return new SignJWT({ typ: 'session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(employeeId)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_HOURS}h`)
      .sign(this.secret);
  }

  get sessionMaxAgeMs() {
    return SESSION_HOURS * 3600_000;
  }

  async verifySession(token: string): Promise<Actor> {
    let sub: string | undefined;
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
      if (payload.typ !== 'session') throw new Error('typ');
      sub = payload.sub;
    } catch {
      throw new AppError('UNAUTHENTICATED', 'انتهت الجلسة، سجّل الدخول من جديد', 401);
    }
    const e = await this.db.one(
      `SELECT e.id, e.org_id, e.role, e.site_id, e.active, o.timezone FROM employees e JOIN organizations o ON o.id=e.org_id WHERE e.id=$1`,
      [sub],
    );
    if (!e || !e.active) throw new AppError('UNAUTHENTICATED', 'الحساب غير نشط', 401);
    return { id: e.id, orgId: e.org_id, role: e.role, siteId: e.site_id, tz: e.timezone };
  }

  /** دخول تجريبي للتطوير والعروض فقط — معطّل في الإنتاج */
  async devLogin(email: string) {
    if (!this.cfg.devLogin) throw new AppError('DISABLED', 'الدخول التجريبي معطّل', 403);
    const e = await this.db.one(`SELECT id, org_id FROM employees WHERE email=lower($1) AND active`, [email]);
    if (!e) throw new AppError('NOT_FOUND', 'لا يوجد موظف بهذا البريد', 404);
    await audit(this.db.pool, { orgId: e.org_id, actorId: e.id, action: 'auth.dev_login', entity: 'employee', entityId: e.id });
    return this.issueSession(e.id);
  }

  private oidc() {
    if (!this.cfg.oidc) throw new AppError('OIDC_NOT_CONFIGURED', 'لم يُضبط تسجيل الدخول بحساب الجهة', 501);
    return this.cfg.oidc;
  }

  private meta(): Promise<any> {
    const o = this.oidc();
    this.discovery ??= fetch(`${o.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`).then((r) => {
      if (!r.ok) throw new AppError('OIDC_ERROR', 'تعذّر الوصول إلى مزوّد الهوية', 502);
      return r.json();
    });
    return this.discovery.catch((e) => {
      this.discovery = undefined;
      throw e;
    });
  }

  /** يبني رابط التفويض ويعيد حالة موقّعة تُحفظ في ملف تعريف ارتباط قصير العمر */
  async oidcStart() {
    const o = this.oidc();
    const m = await this.meta();
    const state = b64url(randomBytes(16));
    const nonce = b64url(randomBytes(16));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const url = new URL(m.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: o.clientId,
      redirect_uri: o.redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    const cookie = await new SignJWT({ state, nonce, verifier })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(this.secret);
    return { url: url.toString(), cookie };
  }

  async oidcCallback(code: string, state: string, cookie: string | undefined) {
    const o = this.oidc();
    if (!cookie) throw new AppError('OIDC_STATE', 'انتهت محاولة الدخول، أعد المحاولة', 400);
    let saved: any;
    try {
      saved = (await jwtVerify(cookie, this.secret, { algorithms: ['HS256'] })).payload;
    } catch {
      throw new AppError('OIDC_STATE', 'انتهت محاولة الدخول، أعد المحاولة', 400);
    }
    if (saved.state !== state) throw new AppError('OIDC_STATE', 'حالة الدخول غير مطابقة', 400);
    const m = await this.meta();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: o.redirectUri,
      client_id: o.clientId,
      code_verifier: saved.verifier,
    });
    if (o.clientSecret) body.set('client_secret', o.clientSecret);
    const res = await fetch(m.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new AppError('OIDC_ERROR', 'رفض مزوّد الهوية طلب الدخول', 502);
    const tokens: any = await res.json();
    const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(m.jwks_uri)), {
      issuer: m.issuer,
      audience: o.clientId,
    });
    if (payload.nonce !== saved.nonce) throw new AppError('OIDC_ERROR', 'رمز الهوية غير صالح', 400);
    const email = String(payload.email ?? '').toLowerCase();
    if (!email) throw new AppError('OIDC_ERROR', 'مزوّد الهوية لم يُرسل البريد', 400);
    const e = await this.db.one(
      `SELECT e.id, e.org_id FROM employees e JOIN organizations o ON o.id=e.org_id
        WHERE e.email=$1 AND e.active AND o.auth_type='oidc' AND o.oidc_issuer=$2`,
      [email, m.issuer],
    );
    if (!e) throw new AppError('NOT_ENROLLED', 'حسابك غير مسجّل في مدار لدى جهتك', 403);
    await audit(this.db.pool, { orgId: e.org_id, actorId: e.id, action: 'auth.oidc_login', entity: 'employee', entityId: e.id });
    return this.issueSession(e.id);
  }
}
