import { Router } from 'express';
import RootController from '../controllers/root.controller.ts';

const rootRouter = Router();
const rootController = new RootController();

// 헬스체크
rootRouter.get('/', rootController.handleHealthCheck.bind(rootController));

export default rootRouter;
