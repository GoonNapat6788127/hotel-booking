import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { notification_type, Prisma, booking_status, booking } from '@prisma/client';

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) { }

  validateDates(checkIn: Date, checkOut: Date): void {
    if (!(checkIn instanceof Date) || isNaN(checkIn.getTime())) {
      throw new BadRequestException('checkIn is not a valid date');
    }

    if (!(checkOut instanceof Date) || isNaN(checkOut.getTime())) {
      throw new BadRequestException('checkOut is not a valid date');
    }

    if (checkIn >= checkOut) {
      throw new BadRequestException('Check-in must be before check-out');
    }
  }

  overlapWhere(checkIn: Date, checkOut: Date): Prisma.bookingWhereInput {
    return {
      status: { not: booking_status.CANCELLED },
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
    };
  }

  private validateStatusTransition(
    from: booking_status,
    to: booking_status,
  ): void {
    const allowed: Record<booking_status, booking_status[]> = {
      [booking_status.PENDING]: [
        booking_status.APPROVED,
        booking_status.CANCELLED,
      ],
      [booking_status.APPROVED]: [
        booking_status.PAID,
        booking_status.CANCELLED,
      ],
      [booking_status.PAID]: [],
      [booking_status.CANCELLED]: [],
    };

    if (!allowed[from].includes(to)) {
      throw new BadRequestException(
        `Cannot change booking status from ${from} to ${to}`,
      );
    }
  }

  private async changeStatus(booking: booking, status: booking_status, message: string) {
    /**
 * Allowed status changes (FR-21, FR-26):
 *   PENDING  -> APPROVED | CANCELLED
 *   APPROVED -> PAID     | CANCELLED
 *   PAID and CANCELLED are final.
 */
    this.validateStatusTransition(booking.status, status);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({ where: { id: booking.id }, data: { status }, include: { room: true } });
      if (status === booking_status.CANCELLED) {
        await tx.notification.create({
          data: {
            userId: booking.userId,
            bookingId: booking.id,
            type: notification_type.BOOKING_CANCELLED,
            message: `Your booking #${booking.id} was cancelled.`,
          },
        });
      }
      return result;
    });

    return { message, data: updated };
  }

  async create(userId: number, dto: CreateBookingDto) {
    this.validateDates(dto.checkIn, dto.checkOut);

    const booking = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT id FROM \`Room\` WHERE id = ${dto.roomId} FOR UPDATE`,
      );

      const room = locked.length ? await tx.room.findFirst({ where: { id: dto.roomId, isActive: true } }) : null;
      if (!room) throw new NotFoundException(`Room ${dto.roomId} not found`);

      const conflict = await tx.booking.findFirst({
        where: { roomId: room.id, ...this.overlapWhere(dto.checkIn, dto.checkOut) },
        select: { id: true },
      });
      if (conflict) throw new ConflictException('Room is already booked for the selected dates');

      const created = await tx.booking.create({
        data: { userId, roomId: room.id, checkIn: dto.checkIn, checkOut: dto.checkOut }, // status = PENDING
        include: { room: true },
      });

      await tx.notification.create({
        data: {
          userId,
          bookingId: created.id,
          type: notification_type.BOOKING_CREATED,
          message: `Your booking #${created.id} for ${room.name} was created and is pending approval.`,
        },
      });
      return created;
    });

    return { message: 'Booking created successfully', data: booking };
  }

  findAllUser(userId: number) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: { room: true },
      orderBy: { id: 'desc' },
    });
  }

  async findOneUser(userId: number, id: number) {
    const booking = await this.prisma.booking.findFirst({ where: { id, userId }, include: { room: true } });
    if (!booking) throw new NotFoundException(`Booking ${id} not found`);
    return booking;
  }

  async cancelBooking(userId: number, id: number) {
    const booking = await this.prisma.booking.findFirst({ where: { id, userId } });
    if (!booking) throw new NotFoundException(`Booking ${id} not found`);
    return this.changeStatus(booking, booking_status.CANCELLED, 'Booking cancelled successfully');
  }

  findAll(status?: booking_status) {
    return this.prisma.booking.findMany({
      where: status ? { status } : undefined,
      include: { room: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: number) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { room: true, user: { select: { id: true, name: true, email: true } } },
    });
    if (!booking) throw new NotFoundException(`Booking ${id} not found`);
    return booking;
  }

  async updateStatus(id: number, status: booking_status) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException(`Booking ${id} not found`);
    return this.changeStatus(booking, status, 'Booking status updated successfully');
  }
}
