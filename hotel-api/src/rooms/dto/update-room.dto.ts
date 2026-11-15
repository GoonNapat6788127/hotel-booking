import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateRoomDto } from './create-room.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateRoomDto extends PartialType(CreateRoomDto) {
  @ApiPropertyOptional({ type: Boolean, example: true, description: 'true = room is active, false = deactivated' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value; // "tree", "falss", "abc" stay invalid -> @IsBoolean fails
  })
  @IsBoolean()
  isActive?: boolean;
}