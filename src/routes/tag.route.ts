import { Router } from 'express';
import TagController from '../controllers/tag.controller.ts';

const tagRouter = Router();
const tagController = new TagController();

// 태그 리스트 조회
tagRouter.get('/', tagController.handleGetTagList.bind(tagController));

export default tagRouter;
