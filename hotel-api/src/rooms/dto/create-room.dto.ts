import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUrl, Max, MaxLength, Min } from "class-validator";

export class CreateRoomDto {
    @IsString()
    @IsNotEmpty({ message: 'name should not be empty' })
    @MaxLength(191)
    name: string;

    @IsInt({ message: 'capacity must be a whole number' })
    @Min(1)
    @Max(50)
    capacity: number;

    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    @Max(10000000)
    pricePerNight: number;

    @IsOptional()
    @IsUrl()
    @MaxLength(500)
    imageUrl?: string;
}
