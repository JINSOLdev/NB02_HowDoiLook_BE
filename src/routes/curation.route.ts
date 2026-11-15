import { Router } from 'express';
import { CurationController } from '../controllers/curation.controller.ts';
import { CommentController } from '../controllers/comment.controller.ts';
import {
  validateRequest,
  createCommentSchema,
  deleteCurationSchema,
  updateCurationSchema,
} from '../middlewares/dto.middleware.ts';

const router = Router();
const curationController = new CurationController();
const commentController = new CommentController();

// 큐레이션 수정
router.put(
  '/:curationId',
  validateRequest(updateCurationSchema),
  CurationController.updateCuration
);
// 큐레이션 삭제
router.delete(
  '/:curationId',
  validateRequest(deleteCurationSchema),
  curationController.deleteCuration.bind(curationController)
);
// 답글 등록
router.post(
  '/:curationId/comments',
  validateRequest(createCommentSchema),
  commentController.createComment.bind(commentController)
);

export default router;
