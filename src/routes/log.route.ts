import { Router } from 'express';
import LogController from '../controllers/log.controller.ts';
import { validateRequest, getLogListSchema } from '../middlewares/dto.middleware.ts';

const logRouter = Router();
const logController = new LogController();

// 로그 리스트 조회
logRouter.get('/', validateRequest(getLogListSchema), logController.handleGetLogList.bind(logController));

export default logRouter;
