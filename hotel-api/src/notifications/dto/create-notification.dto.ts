import { ApiProperty } from "@nestjs/swagger";
import { notification_type } from "@prisma/client";

export class CreateNotificationDto {
    @ApiProperty({ example: 1 })
    id: number;

    @ApiProperty({ example: 5 })
    userId: number;

    @ApiProperty({ example: 12 })
    bookingId: number;

    @ApiProperty({ enum: notification_type, example: notification_type.BOOKING_CREATED })
    type: notification_type;

    @ApiProperty({ example: 'Your booking #12 has been created.' })
    message: string;

    @ApiProperty({ example: '2026-11-01T10:30:00.000Z' })
    createdAt: Date;
}
