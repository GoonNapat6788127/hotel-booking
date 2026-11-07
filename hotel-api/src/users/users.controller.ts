import {
  Controller, Get, Body, Patch, UseGuards, UseInterceptors,
  Inject, Injectable, ExecutionContext,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CacheInterceptor, CacheTTL, CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { invalidateKeys } from '../redis-invalidate';

// Key contains the user id: one cached profile per user
@Injectable()
class UserCacheInterceptor extends CacheInterceptor {
  protected trackBy(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();
    if (req.method !== 'GET' || !req.user) return undefined;
    return `users:${req.user.id}:${req.originalUrl}`;
  }
}

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) { }

  // Clear only this user's cached entries
  private async invalidateUser(userId: number) {
    await invalidateKeys(`users:${userId}:*`);
  }

  @Get('me')
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000) // 30 seconds
  me(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.id);
  }

  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateUserDto) {
    const result = await this.users.updateProfile(user.id, dto);
    await this.invalidateUser(user.id);
    return result;
  }
}