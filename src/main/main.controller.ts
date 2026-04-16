import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt.guard';

type AuthenticatedRequest = Request & {
  user: {
    id: number;
    username: string;
  };
};

@Controller('main')
export class MainController {
  @Get()
  @UseGuards(JwtAuthGuard)
  getMain(@Req() req: AuthenticatedRequest) {
    return {
      message: 'You are authorized to access main!',
      user: req.user,
    };
  }
}
