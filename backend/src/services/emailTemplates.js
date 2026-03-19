const STATUS_COPY = {
  intake: {
    subject: 'Your repair order has been created',
    heading: 'We have your vehicle checked in',
    message: 'Your repair order is now active and our team is preparing the next steps.',
  },
  estimate: {
    subject: 'Your estimate is in progress',
    heading: 'Your estimate is being prepared',
    message: 'Our team is reviewing your vehicle and preparing your repair estimate.',
  },
  approval: {
    subject: 'Your estimate is ready for approval',
    heading: 'Your estimate is ready',
    message: 'Please review and approve your estimate so we can continue with repairs.',
  },
  parts: {
    subject: 'Parts are being coordinated for your repair',
    heading: 'Parts process underway',
    message: 'We are sourcing and organizing the parts needed for your repair.',
  },
  repair: {
    subject: 'Your repair is in progress',
    heading: 'Repairs are underway',
    message: 'Your vehicle is currently in the repair phase.',
  },
  paint: {
    subject: 'Your vehicle is in the paint stage',
    heading: 'Paint and refinishing in progress',
    message: 'Your vehicle is in paint and refinishing.',
  },
  qc: {
    subject: 'Your vehicle is in final quality check',
    heading: 'Final quality checks in progress',
    message: 'Your vehicle is going through quality control before delivery.',
  },
  delivery: {
    subject: 'Your vehicle is ready for pickup',
    heading: 'Your vehicle is ready',
    message: 'Your vehicle is ready for pickup. Please contact us to schedule pickup.',
  },
  closed: {
    subject: 'Your repair order is complete',
    heading: 'Repair order completed',
    message: 'Your repair order has been completed and closed.',
  },
  total_loss: {
    subject: 'Update on your repair order status',
    heading: 'Total loss status update',
    message: 'Your repair order has been marked as total loss. Please contact the shop with any questions.',
  },
  siu_hold: {
    subject: 'Update on your repair order status',
    heading: 'Repair order currently on hold',
    message: 'Your repair order is currently on hold pending insurance review.',
  },
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatStatus(status) {
  return String(status || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function statusChangeEmail({ shopName, roNumber, vehicle, status, portalUrl }) {
  const statusKey = String(status || '').trim().toLowerCase();
  const content = STATUS_COPY[statusKey] || {
    subject: `Update on RO #${roNumber || ''}`.trim(),
    heading: 'Repair order status updated',
    message: 'There is a new update on your repair order.',
  };
  const safeShopName = escapeHtml(shopName || 'Your Repair Shop');
  const safeRoNumber = escapeHtml(roNumber || 'N/A');
  const safeVehicle = escapeHtml(vehicle || 'Vehicle on file');
  const safeStatus = escapeHtml(formatStatus(status));
  const safeHeading = escapeHtml(content.heading);
  const safeMessage = escapeHtml(content.message);
  const safePortalUrl = portalUrl ? escapeHtml(portalUrl) : null;
  const portalSection = safePortalUrl
    ? `<p style="margin: 24px 0 0;">
         <a href="${safePortalUrl}" style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; font-weight: 600; padding: 10px 16px; border-radius: 6px;">
           View Repair Status
         </a>
       </p>`
    : '';

  return {
    subject: content.subject,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">${safeHeading}</h2>
        <p style="margin: 0 0 16px;">${safeMessage}</p>
        <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin: 0 0 16px;">
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #6b7280;">Shop</td>
            <td style="padding: 4px 0;"><strong>${safeShopName}</strong></td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #6b7280;">RO Number</td>
            <td style="padding: 4px 0;"><strong>${safeRoNumber}</strong></td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #6b7280;">Vehicle</td>
            <td style="padding: 4px 0;"><strong>${safeVehicle}</strong></td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #6b7280;">New Status</td>
            <td style="padding: 4px 0;"><strong>${safeStatus}</strong></td>
          </tr>
        </table>
        ${portalSection}
      </div>
    `,
  };
}

function paymentConfirmationEmail({ shopName, roNumber, amountFormatted, customerName, email }) {
  const safeShopName = escapeHtml(shopName || 'Your Repair Shop');
  const safeRoNumber = escapeHtml(roNumber || 'N/A');
  const safeAmount = escapeHtml(amountFormatted || '$0.00');
  const safeCustomerName = escapeHtml(customerName || 'Valued Customer');

  return {
    subject: `Payment Confirmation — RO #${roNumber || ''}`.trim(),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Payment Received</h2>
        <p style="margin: 0 0 16px;">Hi ${safeCustomerName},</p>
        <p style="margin: 0 0 16px;">Thank you! We have received your payment for repair order <strong>#${safeRoNumber}</strong>.</p>
        <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin: 0 0 16px;">
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #6b7280;">Shop</td>
            <td style="padding: 4px 0;"><strong>${safeShopName}</strong></td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #6b7280;">RO Number</td>
            <td style="padding: 4px 0;"><strong>${safeRoNumber}</strong></td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #6b7280;">Amount Paid</td>
            <td style="padding: 4px 0;"><strong>${safeAmount}</strong></td>
          </tr>
        </table>
        <p style="margin: 0 0 16px;">Your vehicle will continue through our repair process. We will keep you updated on the status.</p>
        <p style="color: #6b7280; font-size: 13px; margin: 0;">If you have any questions, please contact ${safeShopName} directly.</p>
      </div>
    `,
  };
}

module.exports = { statusChangeEmail, paymentConfirmationEmail };
