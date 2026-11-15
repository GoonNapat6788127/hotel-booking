import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDate, IsInt, IsNumber, IsOptional, Min } from "class-validator";

export class SearchRoomsDto {
    @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-12-01T14:00:00Z', description: 'ISO 8601. Must be sent together with checkOut' })
    @Type(() => Date)
    @IsDate({ message: 'checkIn must be a valid date (ISO 8601)' })
    @IsOptional()
    checkIn: Date;

    @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-12-03T12:00:00Z', description: 'ISO 8601. Must be after checkIn' })
    @Type(() => Date)
    @IsDate({ message: 'checkOut must be a valid date (ISO 8601)' })
    @IsOptional()
    checkOut: Date;

    @ApiPropertyOptional({ example: 2, minimum: 1, description: 'Minimum number of guests' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    capacity?: number;

    @ApiPropertyOptional({ example: 3000, minimum: 0, description: 'Maximum price per night' })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    maxPrice?: number;
}