import { Body, Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService, OIDC_COOKIE, SESSION_COOKIE } from './auth.service';
import { CurrentActor, Public } from './guard';
import { Actor } from '../common/actor';
import { parse } from '../common/validation';
import { AppConfig, CONFIG } from '../config';
import { DB, Db } from '../db/db';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(DB) private readonly db: Db,
  ) {}

  private setSession(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: this.auth.sessionMaxAgeMs,
      path: '/',
    });
  }

  @Public()
  @Get('options')
  options() {
    return { devLogin: this.cfg.devLogin, oidc: !!this.cfg.oidc, saml: false };
  }

  @Public()
  @Post('dev-login')
  async devLogin(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email } = parse(z.object({ email: z.string().email() }), body);
    this.setSession(res, await this.auth.devLogin(email));
    return { ok: true };
  }

  @Public()
  @Get('demo-accounts')
  async demoAccounts() {
    if (!this.cfg.devLogin) return [];
    return this.db.query(`SELECT name, email, role FROM employees WHERE active ORDER BY (role = 'admin') DESC, name LIMIT 20`);
  }

  @Public()
  @Get('oidc/start')
  async oidcStart(@Res() res: Response) {
    const { url, cookie } = await this.auth.oidcStart();
    res.cookie(OIDC_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 600_000, path: '/' });
    res.redirect(url);
  }

  @Public()
  @Get('oidc/callback')
  async oidcCallback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    const token = await this.auth.oidcCallback(String(code ?? ''), String(state ?? ''), req.cookies?.[OIDC_COOKIE]);
    res.clearCookie(OIDC_COOKIE, { path: '/' });
    this.setSession(res, token);
    res.redirect('/');
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentActor() a: Actor) {
    return this.db.one(
      `SELECT e.id, e.name, e.email, e.role, e.eligible, e.travel_mode AS "travelMode", to_char(e.preferred_start,'HH24:MI') AS "preferredStart",
              s.id AS "siteId", s.name AS "siteName", d.name AS "district", d.id AS "districtId",
              o.name AS "orgName", o.timezone
         FROM employees e JOIN organizations o ON o.id=e.org_id
         LEFT JOIN sites s ON s.id=e.site_id LEFT JOIN districts d ON d.id=e.district_id
        WHERE e.id=$1`,
      [a.id],
    );
  }
}
