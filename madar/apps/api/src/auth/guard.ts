import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { AppError } from '../common/errors';
import { Actor } from '../common/actor';

export const PUBLIC = 'madar:public';
export const ROLES = 'madar:roles';
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...roles: Actor['role'][]) => SetMetadata(ROLES, roles);
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor);

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    // حماية CSRF: الطلبات المعدِّلة يجب أن تحمل ترويسة مخصصة لا يستطيع موقع آخر إرسالها دون CORS
    if (!SAFE.has(req.method) && req.headers['x-requested-with'] !== 'madar') {
      throw new AppError('CSRF', 'طلب غير موثوق', 403);
    }
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const header = req.headers.authorization as string | undefined;
    const token = req.cookies?.[SESSION_COOKIE] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) throw new AppError('UNAUTHENTICATED', 'يلزم تسجيل الدخول', 401);
    req.actor = await this.auth.verifySession(token);
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, targets);
    if (roles && !roles.includes(req.actor.role)) throw new AppError('FORBIDDEN', 'لا تملك صلاحية هذا الإجراء', 403);
    return true;
  }
}
