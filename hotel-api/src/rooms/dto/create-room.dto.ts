import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUrl, Max, MaxLength, Min } from "class-validator";
import { Type } from 'class-transformer';

export class CreateRoomDto {
    @ApiProperty({ example: 'Deluxe Sea View', maxLength: 191 })
    @IsString()
    @IsNotEmpty({ message: 'name should not be empty' })
    @MaxLength(191)
    name: string;

    @ApiProperty({ example: 2, minimum: 1, maximum: 50 })
    @Type(() => Number)
    @IsInt({ message: 'capacity must be a whole number' })
    @Min(1)
    @Max(50)
    capacity: number;

    @ApiProperty({ example: 2500, description: 'Price per night (max 2 decimals, max 10,000,000)' })
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    @Max(10000000)
    pricePerNight: number;

    @ApiPropertyOptional({ example: 'http://localhost:3000/uploads/rooms/room1.jpg', maxLength: 500, description: 'Optional image URL. Ignored when an image file is uploaded' })
    @IsOptional()
    @IsUrl({ require_tld: false })
    @MaxLength(500)
    imageUrl?: string;
}