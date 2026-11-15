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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

// Key contains the user id: one cached profile per user
@Injectable()
class UserCacheInterceptor extends CacheInterceptor {
  protected trackBy(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();
    if (req.method !== 'GET' || !req.user) return undefined;
    return `users:${req.user.id}:${req.originalUrl}`;
  }
}

@ApiTags('users')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Unauthorized - missing, invalid or revoked token' })
@ApiResponse({ status: 429, description: 'Too Many Requests' })
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

  @ApiOperation({ summary: 'View my profile', description: 'Returns the logged-in user (no password). Cached for 30 seconds per user.' })
  @ApiResponse({ status: 200, description: 'Current user profile', schema: { example: { id: 1, name: 'John Doe', email: 'john@example.com', role: 'USER', createdAt: '2026-11-01T10:00:00.000Z' } } })
  @ApiResponse({ status: 404, description: 'User not found' })
  @Get('me')
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000) // 30 seconds
  me(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.id);
  }

  @ApiOperation({ summary: 'Update my profile', description: 'Change name and/or password of the logged-in user.' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully', schema: { example: { message: 'Profile updated successfully', data: { id: 1, name: 'John Doe', email: 'john@example.com', role: 'USER', createdAt: '2026-11-01T10:00:00.000Z' } } } })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid data' })
  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateUserDto) {
    const result = await this.users.updateProfile(user.id, dto);
    await this.invalidateUser(user.id);
    return result;
  }
}