const supabase = require('../lib/supabase'); // Use service_role to bypass RLS

/**
 * Creates an Express middleware that logs an audit event when the request completes successfully.
 *
 * @param {string} entity - The entity being affected (e.g., 'patient', 'appointment')
 * @param {string} defaultAction - The fallback action if we can't infer it from the method
 */
function createAuditLogger(entity, defaultAction = null) {
  return function auditMiddleware(req, res, next) {
    res.on('finish', async () => {
      // Only log successful actions (2xx and 3xx)
      if (res.statusCode >= 400) return;

      const clinicId = req.clinicId;
      const userId   = req.user?.id;

      // super_admin has clinicId = null — skip audit for now to avoid FK violation
      if (!clinicId || !userId) return;

      let action = defaultAction;
      if (!action) {
        switch (req.method) {
          case 'GET':
            if (req.params.id) action = `VIEW_${entity.toUpperCase()}`;
            else if (req.path.includes('export')) action = `EXPORT_${entity.toUpperCase()}_DATA`;
            else action = `LIST_${entity.toUpperCase()}`;
            break;
          case 'POST':
            action = `CREATE_${entity.toUpperCase()}`;
            break;
          case 'PUT':
          case 'PATCH':
            action = `UPDATE_${entity.toUpperCase()}`;
            break;
          case 'DELETE':
            if (req.path.includes('erase')) action = `${entity.toUpperCase()}_ERASED`;
            else action = `DELETE_${entity.toUpperCase()}`;
            break;
          default:
            action = `ACCESS_${entity.toUpperCase()}`;
        }
      }

      const entityId = req.params.id || req.body?.id || null;

      // ─── KEY FIX: Supabase JS never throws — always check the returned error ───
      const { error } = await supabase.from('audit_logs').insert({
        clinic_id:  clinicId,
        user_id:    userId,
        action,
        entity,
        entity_id:  entityId || null,
        ip_address: req.headers['x-forwarded-for']?.split(',')[0].trim()
                    || req.socket?.remoteAddress
                    || null,
        metadata: {
          path:   req.originalUrl,
          method: req.method,
          query:  req.query
        }
      });

      if (error) {
        // Never crash the app — audit failures are logged, never propagated
        console.error('[Audit Logger] INSERT failed:', error.message, '| action:', action, '| entity:', entity, '| clinic:', clinicId);
      } else if (process.env.NODE_ENV !== 'production') {
        console.log(`[Audit Logger] ✅ ${action} on ${entity}${entityId ? ' (' + entityId + ')' : ''}`);
      }
    });

    next();
  };
}

module.exports = {
  auditLogger: createAuditLogger
};
