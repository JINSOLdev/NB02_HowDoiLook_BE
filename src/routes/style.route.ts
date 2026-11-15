import { Router } from 'express';
import { StyleController } from '../controllers/style.controller.ts';
import { hashPasswordMiddleware } from '../middlewares/bcrypt.middleware.ts';
import {
  validateRequest,
  createStyleSchema,
  getStyleListSchema,
  getStyleDetailSchema,
  updateStyleSchema,
  deleteStyleSchema,
  createCurationSchema,
  getCurationListSchema,
} from '../middlewares/dto.middleware.ts';

const router = Router();
const styleController = new StyleController();

// 스타일 등록
router.post(
  '/',
  validateRequest(createStyleSchema),
  hashPasswordMiddleware,
  styleController.createStyle.bind(styleController)
);
// 스타일 조회
router.get('/', validateRequest(getStyleListSchema), styleController.getStyleList.bind(styleController));
// 스타일 상세조회
router.get('/:styleId', validateRequest(getStyleDetailSchema), styleController.getStyleDetail.bind(styleController));
// 스타일 수정
router.put('/:styleId', validateRequest(updateStyleSchema), styleController.updateStyle.bind(styleController));
// 스타일 삭제
router.delete('/:styleId', validateRequest(deleteStyleSchema), styleController.deleteStyle.bind(styleController));

// 큐레이션 등록
router.post(
  '/:styleId/curations',
  validateRequest(createCurationSchema),
  hashPasswordMiddleware,
  styleController.createCuration.bind(styleController)
);

// 스타일별 큐레이션 리스트 조회
router.get(
  '/:styleId/curations',
  validateRequest(getCurationListSchema),
  styleController.getCurationList.bind(styleController)
);

export default router;
