import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { user_role } from '@prisma/client';

export interface AuthUser {
  id: number;
  email: string;
  role: user_role;
  jti: string;
  exp: number;
}

/** Injects the authenticated user (set by the JWT strategy) into a handler. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
