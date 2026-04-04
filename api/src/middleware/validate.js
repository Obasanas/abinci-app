// src/middleware/validate.js
import Joi from 'joi';

export function validate(schema, target = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[target], { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map(d => d.message);
      return res.status(400).json({ error: 'Validation failed', details });
    }
    req[target] = value;
    next();
  };
}

// ── Shared schemas ────────────────────────────────────────────

export const schemas = {
  sendOTP: Joi.object({
    phone: Joi.string().min(7).max(15).required(),
  }),

  verifyOTP: Joi.object({
    phone: Joi.string().min(7).max(15).required(),
    code:  Joi.string().length(4).pattern(/^\d+$/).required(),
    name:  Joi.string().max(100).optional().allow(''),
    role:  Joi.string().valid('customer', 'vendor').optional(),
  }),

  placeOrder: Joi.object({
    vendor_id:     Joi.string().uuid().required(),
    customer_name: Joi.string().max(100).required(),
    customer_phone:Joi.string().max(20).required(),
    items: Joi.array().items(Joi.object({
      name:       Joi.string().required(),
      price:      Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      qty:        Joi.number().integer().min(1).required(),
      emoji:      Joi.string().optional(),
      menuIndex:  Joi.number().optional(),
      plates:     Joi.number().allow(null).optional(),
    })).min(1).required(),
    total_amount:  Joi.number().min(0).required(),
    delivery_type: Joi.string().valid('delivery', 'pickup').default('delivery'),
    note:          Joi.string().max(500).optional().allow(''),
  }),

  updateOrderStatus: Joi.object({
    status: Joi.string().valid('accepted', 'rejected', 'ready', 'delivered').required(),
  }),

  updateVendor: Joi.object({
    business_name:   Joi.string().max(100).optional(),
    bio:             Joi.string().max(500).optional(),
    area:            Joi.string().max(100).optional(),
    city:            Joi.string().max(100).optional(),
    state:           Joi.string().max(100).optional(),
    food_types:      Joi.array().items(Joi.string()).optional(),
    delivery_option: Joi.string().valid('delivery', 'pickup', 'both').optional(),
    delivery_fee:    Joi.number().min(0).optional(),
    is_available:    Joi.boolean().optional(),
    open_time:       Joi.string().optional(),
    close_time:      Joi.string().optional(),
    min_order:       Joi.number().min(0).optional().allow(null),
  }),

  registerPush: Joi.object({
    endpoint: Joi.string().uri().required(),
    p256dh:   Joi.string().required(),
    auth:     Joi.string().required(),
    user_id:  Joi.string().uuid().optional(),
  }),
};
