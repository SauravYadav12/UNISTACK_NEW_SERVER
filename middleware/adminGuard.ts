import { Request, Response, NextFunction } from "express";
import { UserRole } from "../enums/UserEnum";
import { UserDoc } from "../interface";

export const roleGuard =
  (role: UserRole) => (req: Request, res: Response, next: NextFunction) => {
    if (!((req.user as UserDoc)?.role?.includes(role))) {
      res.status(403).json({
        success: false,
        message: "Forbidden: Admin privileges required",
      });
      return;
    }
    next();
  };

export const anyRoleGuard =
  (...roles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const userRoles = (req.user as UserDoc)?.role || [];
    if (!roles.some((r) => userRoles.includes(r))) {
      res.status(403).json({
        success: false,
        message: "Forbidden: Insufficient privileges",
      });
      return;
    }
    next();
  };
