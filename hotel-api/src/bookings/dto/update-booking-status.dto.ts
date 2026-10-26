import { ApiProperty } from "@nestjs/swagger";
import { booking_status } from "@prisma/client";
import { IsEnum } from "class-validator";

export class UpdateBookingStatusDto {
  @ApiProperty({ enum: booking_status, example: booking_status.APPROVED })
  @IsEnum(booking_status, { message: `status must be one of: ${Object.values(booking_status).join(', ')}` })
  status: booking_status;
}