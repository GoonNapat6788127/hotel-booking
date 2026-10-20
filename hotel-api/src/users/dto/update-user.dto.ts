import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: 'name should not be empty' })
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @IsString()
    @MinLength(8, { message: 'password must be at least 8 characters' })
    @MaxLength(72)
    password?: string;
}