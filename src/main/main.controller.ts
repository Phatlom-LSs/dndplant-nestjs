import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt.guard';

@Controller('main')
export class MainController {
  @Get()
  @UseGuards(JwtAuthGuard)
  getMain(@Req() req) {
    return {
      message: 'You are authorized to access main!',
      user: req.user,
    };
  }
}
