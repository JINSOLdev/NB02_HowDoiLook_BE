import { Router } from 'express';
import { CommentController } from '../controllers/comment.controller.ts';
import { validateRequest, updateCommentSchema, deleteCommentSchema } from '../middlewares/dto.middleware.ts';

const router = Router();
const commentController = new CommentController();

// 답글 수정
router.put(
  '/:commentId',
  validateRequest(updateCommentSchema),
  commentController.updateComment.bind(commentController)
);
// 답글 삭제
router.delete(
  '/:commentId',
  validateRequest(deleteCommentSchema),
  commentController.deleteComment.bind(commentController)
);

export default router;
