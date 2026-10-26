import { ApiPropertyOptional } from "@nestjs/swagger";
import { booking_status } from "@prisma/client";
import { IsEnum, IsOptional } from "class-validator";

export class ListBookingsQueryDto {
  @ApiPropertyOptional({ enum: booking_status })
  @IsOptional()
  @IsEnum(booking_status)
  status?: booking_status;
}
