import { Prisma, booking_status } from '@prisma/client';

export function overlapWhere(checkIn: Date, checkOut: Date): Prisma.bookingWhereInput {
  return {
    status: { not: booking_status.CANCELLED },
    checkIn: { lt: checkOut },
    checkOut: { gt: checkIn },
  };
}