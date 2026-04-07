function isSuperAdmin(user) {
  return user?.role === "super_admin";
}

function isAdmin(user) {
  return user?.role === "admin";
}

function getGovernorateScope(req, { allowQuery = false } = {}) {
  if (isSuperAdmin(req.user)) {
    return null;
  }

  if (req.user?.governorateId) {
    return Number(req.user.governorateId);
  }

  if (allowQuery && req.query?.governorateId) {
    const governorateId = Number(req.query.governorateId);
    return Number.isInteger(governorateId) && governorateId > 0
      ? governorateId
      : undefined;
  }

  return undefined;
}

function applyGovernorateScope(where = {}, governorateId) {
  if (governorateId === null) {
    return where;
  }

  if (!Number.isInteger(governorateId) || governorateId <= 0) {
    return where;
  }

  return {
    ...where,
    governorateId,
  };
}

function ensureGovernorateAccess(req, res, resourceGovernorateId) {
  if (isSuperAdmin(req.user)) return true;

  const currentGovernorateId = Number(req.user?.governorateId);
  if (!currentGovernorateId) {
    res.status(403).json({ error: "Governorate access is not configured" });
    return false;
  }

  if (Number(resourceGovernorateId) !== currentGovernorateId) {
    res.status(403).json({ error: "Not allowed for this governorate" });
    return false;
  }

  return true;
}

module.exports = {
  isAdmin,
  isSuperAdmin,
  getGovernorateScope,
  applyGovernorateScope,
  ensureGovernorateAccess,
};
