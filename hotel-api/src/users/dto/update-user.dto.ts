import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
    @ApiPropertyOptional({ example: 'John Smith', maxLength: 100 })
    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: 'name should not be empty' })
    @MaxLength(100)
    name?: string;

    @ApiPropertyOptional({ example: 'NewPassword123', minLength: 8, maxLength: 72 })
    @IsOptional()
    @IsString()
    @MinLength(8, { message: 'password must be at least 8 characters' })
    @MaxLength(72)
    password?: string;
}