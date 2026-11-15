import {
  Controller, Get, Post, Body, Patch, Param, ParseIntPipe, Query,
  UseGuards, UseInterceptors, Inject, Injectable, ExecutionContext,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ListBookingsQueryDto } from './dto/list-booking-query.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { user_role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CacheInterceptor, CacheTTL, CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { invalidateKeys } from '../redis-invalidate';

// Swagger example payloads
const bookingExample = {
  id: 12, userId: 1, roomId: 1, status: 'PENDING',
  checkIn: '2026-12-01T14:00:00.000Z', checkOut: '2026-12-03T12:00:00.000Z', createdAt: '2026-11-09T08:30:00.000Z',
  room: { id: 1, name: 'Deluxe Sea View', capacity: 2, pricePerNight: '2500', imageUrl: null, isActive: true, createdAt: '2026-11-01T10:00:00.000Z' },
};
const bookingAdminExample = { ...bookingExample, user: { id: 1, name: 'John Doe', email: 'john@example.com' } };

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
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Unauthorized - missing, invalid or revoked token' })
@ApiResponse({ status: 429, description: 'Too Many Requests' })
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
  @ApiOperation({ summary: 'Create a booking', description: 'Logged-in user. Status starts as PENDING and a BOOKING_CREATED notification is recorded. checkIn must be before checkOut and the room must be free for the dates.' })
  @ApiResponse({ status: 201, description: 'Booking created successfully', schema: { example: { message: 'Booking created successfully', data: bookingExample } } })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid dates or data' })
  @ApiResponse({ status: 404, description: 'Room not found or not active' })
  @ApiResponse({ status: 409, description: 'Conflict - room is already booked for the selected dates' })
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    const result = await this.bookingsService.create(user.id, dto);
    await this.invalidateBookings();
    return result;
  }

  @ApiOperation({ summary: 'List my bookings', description: 'Bookings of the logged-in user, newest first. Cached for 30 seconds.' })
  @ApiResponse({ status: 200, description: 'My bookings', schema: { type: 'array', items: { example: bookingExample } } })
  @Get('me')
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000)
  findAllUser(@CurrentUser() user: AuthUser) {
    return this.bookingsService.findAllUser(user.id);
  }

  @ApiOperation({ summary: 'View one of my bookings' })
  @ApiResponse({ status: 200, description: 'Booking details', schema: { example: bookingExample } })
  @ApiResponse({ status: 404, description: 'Booking not found (or not yours)' })
  @Get('me/:id')
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000)
  findOneUser(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.findOneUser(user.id, id);
  }

  @ApiOperation({ summary: 'Cancel my booking', description: 'Allowed from PENDING or APPROVED. Records a BOOKING_CANCELLED notification.' })
  @ApiResponse({ status: 200, description: 'Booking cancelled successfully', schema: { example: { message: 'Booking cancelled successfully', data: { ...bookingExample, status: 'CANCELLED' } } } })
  @ApiResponse({ status: 400, description: 'Bad Request - status change not allowed (e.g. PAID or already CANCELLED)' })
  @ApiResponse({ status: 404, description: 'Booking not found (or not yours)' })
  @Patch('me/:id/cancel')
  async cancelBooking(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const result = await this.bookingsService.cancelBooking(user.id, id);
    await this.invalidateBookings();
    return result;
  }

  // Admin
  @ApiOperation({ summary: 'List all bookings (Admin)', description: 'Admin only. Optional filter by status. Includes the user and room of each booking.' })
  @ApiResponse({ status: 200, description: 'All bookings', schema: { type: 'array', items: { example: bookingAdminExample } } })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Get()
  @Roles(user_role.ADMIN)
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000)
  findAll(@Query() q: ListBookingsQueryDto) {
    return this.bookingsService.findAll(q.status);
  }

  @ApiOperation({ summary: 'View any booking (Admin)' })
  @ApiResponse({ status: 200, description: 'Booking details', schema: { example: bookingAdminExample } })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Get(':id')
  @Roles(user_role.ADMIN)
  @UseInterceptors(UserCacheInterceptor)
  @CacheTTL(30000)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.findOne(id);
  }

  @ApiOperation({ summary: 'Change booking status (Admin)', description: 'Allowed: PENDING to APPROVED or CANCELLED, APPROVED to PAID or CANCELLED. PAID and CANCELLED are final.' })
  @ApiResponse({ status: 200, description: 'Booking status updated successfully', schema: { example: { message: 'Booking status updated successfully', data: { ...bookingExample, status: 'APPROVED' } } } })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid status or transition not allowed' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Patch(':id/status')
  @Roles(user_role.ADMIN)
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookingStatusDto) {
    const result = await this.bookingsService.updateStatus(id, dto.status);
    await this.invalidateBookings();
    return result;
  }
}