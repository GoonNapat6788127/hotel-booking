import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { user_role } from '@prisma/client';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
    @ApiProperty({ example: 'John Doe', maxLength: 100 })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;

    @ApiProperty({ example: 'john@example.com', maxLength: 191 })
    @IsEmail({}, { message: 'email must be a valid email address' })
    @MaxLength(191)
    email: string;

    @ApiProperty({ example: 'MyPassword123', minLength: 8, maxLength: 72, description: 'Stored as a bcrypt hash, never returned' })
    @IsString()
    @MinLength(8, { message: 'password must be at least 8 characters' })
    @MaxLength(72, { message: 'password must be at most 72 characters' })
    password: string;

    @ApiPropertyOptional({ enum: user_role, default: user_role.USER, example: user_role.USER })
    @IsOptional()
    @IsEnum(user_role)
    role?: user_role;
}