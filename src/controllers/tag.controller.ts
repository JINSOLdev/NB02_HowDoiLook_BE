import { Request, Response, NextFunction } from 'express';
import TagService from '../services/tag.service.ts';

export default class TagController {
  async handleGetTagList(_req: Request, res: Response, next: NextFunction) {
    try {
      const tagList = await new TagService().getTagList();
      return res.status(200).json({ tags: tagList });
    } catch (error) {
      next(error);
    }
  }
}
