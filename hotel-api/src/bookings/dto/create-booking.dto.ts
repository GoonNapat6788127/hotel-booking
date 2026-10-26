import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt({ message: 'roomId must be a whole number' })
  @Min(1)
  roomId: number;

  @ApiProperty({ example: '2026-12-01T14:00:00Z', description: 'ISO 8601 date/time' })
  @Type(() => Date)
  @IsDate({ message: 'checkIn must be a valid date (ISO 8601)' })
  checkIn: Date;

  @ApiProperty({ example: '2026-12-03T12:00:00Z', description: 'ISO 8601 date/time' })
  @Type(() => Date)
  @IsDate({ message: 'checkOut must be a valid date (ISO 8601)' })
  checkOut: Date;
}
