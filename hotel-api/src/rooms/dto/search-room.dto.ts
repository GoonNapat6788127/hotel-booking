import { Type } from "class-transformer";
import { IsDate, IsInt, IsOptional, Min } from "class-validator";

export class SearchRoomsDto {
    @Type(() => Date)
    @IsDate({ message: 'checkIn must be a valid date (ISO 8601)' })
    checkIn: Date;

    @Type(() => Date)
    @IsDate({ message: 'checkOut must be a valid date (ISO 8601)' })
    checkOut: Date;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    capacity?: number;
}