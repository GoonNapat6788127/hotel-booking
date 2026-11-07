import {
  Controller, Get, Post, Body, Patch, Param, ParseIntPipe, Query,
  UseGuards, UseInterceptors, Inject, Injectable, ExecutionContext,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ApiBearerAuth, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ListBookingsQueryDto } from './dto/list-booking-query.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { user_role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CacheInterceptor, CacheTTL, CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { invalidateKeys } from '../redis-invalidate';

// Key contains the user id, so /bookings/me never leaks between users
@Injectable()
class UserCacheInterceptor extends CacheInterceptor {
  protected trackBy(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();
    if (req.method !== 'GET' || !req.user) return undefined;
    return `bookings:${req.user.id}:${req.originalUrl}`;
  }
}

@ApiTags('bookings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) { }

  // Clear all cached bookings (users' and admin's views)
  private async invalidateBookings() {
    await invalidateKeys('bookings:*');
  }

  // User
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    const result = await this.bookingsService.create(user.id, dto);
    await this.invalidateBookings();
    return result;
  }

  @Get('me')
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000)
  findAllUser(@CurrentUser() user: AuthUser) {
    return this.bookingsService.findAllUser(user.id);
  }

  @Get('me/:id')
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000)
  findOneUser(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.findOneUser(user.id, id);
  }

  @Patch('me/:id/cancel')
  async cancelBooking(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const result = await this.bookingsService.cancelBooking(user.id, id);
    await this.invalidateBookings();
    return result;
  }

  // Admin
  @Get()
  @Roles(user_role.ADMIN)
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000)
  findAll(@Query() q: ListBookingsQueryDto) {
    return this.bookingsService.findAll(q.status);
  }

  @Get(':id')
  @Roles(user_role.ADMIN)
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.findOne(id);
  }

  @Patch(':id/status')
  @Roles(user_role.ADMIN)
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookingStatusDto) {
    const result = await this.bookingsService.updateStatus(id, dto.status);
    await this.invalidateBookings();
    return result;
  }
}