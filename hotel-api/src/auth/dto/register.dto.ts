import { user_role } from '@prisma/client';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;

    @IsEmail({}, { message: 'email must be a valid email address' })
    @MaxLength(191)
    email: string;

    @IsString()
    @MinLength(8, { message: 'password must be at least 8 characters' })
    @MaxLength(72, { message: 'password must be at most 72 characters' })
    password: string;

    @IsOptional()
    @IsEnum(user_role)
    role?: user_role;
}