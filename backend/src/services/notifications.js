function getStatusMessage(status, shopName, vehicleYear, vehicleMake, vehicleModel) {
  const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ').trim();
  const safeVehicle = vehicle || 'vehicle';
  const safeShopName = shopName || 'our shop';

  const templates = {
    intake: `Hi! Your ${safeVehicle} has been checked in at ${safeShopName}. We'll be in touch soon.`,
    estimate: `Your estimate for your ${safeVehicle} is ready at ${safeShopName}. We'll contact you shortly to review.`,
    approval: `Great news! Repairs have been approved and work is beginning on your ${safeVehicle} at ${safeShopName}.`,
    parts: `Parts have been ordered for your ${safeVehicle}. We'll update you when they arrive.`,
    repair: `Your ${safeVehicle} is actively being repaired at ${safeShopName}. We're on it!`,
    paint: `Your ${safeVehicle} is in the paint booth at ${safeShopName}. Almost there!`,
    qc: `Your ${safeVehicle} is in final quality inspection at ${safeShopName}. Nearly ready!`,
    delivery: `🎉 Your ${safeVehicle} is ready for pickup at ${safeShopName}! Please call us to arrange a time.`,
    closed: `Thank you for choosing ${safeShopName}! Your ${safeVehicle} repair is complete. We appreciate your business.`,
  };

  return templates[status] || null;
}

module.exports = { getStatusMessage };
