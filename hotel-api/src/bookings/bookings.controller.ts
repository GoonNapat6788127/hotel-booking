import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ApiBearerAuth, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ListBookingsQueryDto } from './dto/list-booking-query.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { user_role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('bookings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) { }

  // User
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(user.id, dto);
  }

  @Get('me')
  findAllUser(@CurrentUser() user: AuthUser) {
    return this.bookingsService.findAllUser(user.id);
  }

  @Get('me/:id')
  findOneUser(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.findOneUser(user.id, id);
  }

  @Patch('me/:id/cancel')
  cancelBooking(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.cancelBooking(user.id, id);
  }

  // Admin
  @Get()
  @Roles(user_role.ADMIN)
  findAll(@Query() q: ListBookingsQueryDto) {
    return this.bookingsService.findAll(q.status);
  }

  @Get(':id')
  @Roles(user_role.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.findOne(id);
  }

  @Patch(':id/status')
  @Roles(user_role.ADMIN)
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookingStatusDto) {
    return this.bookingsService.updateStatus(id, dto.status);
  }
}
