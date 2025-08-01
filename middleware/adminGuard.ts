import { Request, Response, NextFunction } from "express";
import { UserRole } from "../enums/UserEnum";

export const roleGuard =
  (role: UserRole) => (req: Request, res: Response, next: NextFunction) => {
    if ((req.user as any)?.role !== role) {
      res.status(403).json({
        success: false,
        message: "Forbidden: Admin privileges required",
      });
      return;
    }
    next();
  };
