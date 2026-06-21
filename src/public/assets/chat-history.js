/**
 * Shared WhatsApp-style chat-history renderer.
 *
 * Used by the read-only Inbox (inbox.js). Kept self-contained so it can be
 * loaded on pages that do NOT include dashboard.js. Mirrors the bubble markup
 * and helpers in dashboard.js so the Inbox thread looks identical to the
 * Verification Desk history view.
 *
 * Exposes a single global: window.PulsoChat
 */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function formatStatus(status) {
    return String(status || '').replace(/_/g, ' ');
  }

  function formatHistoryTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  function formatQualification(value) {
    if (value === 'gda') return 'GDA';
    if (value === 'gnm') return 'GNM';
    if (value === 'anm') return 'ANM';
    if (value === 'hca') return 'HCA';
    if (value === 'bsc_nursing') return 'BSc Nursing';
    if (value === 'other_caregiving') return 'Other caregiving';
    return value ? formatStatus(value) : '-';
  }

  function getInboundMessageContent(payload) {
    if (!payload) return '';
    if (payload.text && payload.text.body) return payload.text.body;
    if (payload.button && payload.button.text) return payload.button.text;
    if (payload.interactive && payload.interactive.button_reply) {
      return payload.interactive.button_reply.title || 'Button reply';
    }
    if (payload.interactive && payload.interactive.list_reply) {
      return payload.interactive.list_reply.title || 'List reply';
    }
    if (payload.document) return payload.document.filename || 'Document uploaded';
    if (payload.image) return payload.image.caption || 'Image uploaded';
    return '';
  }

  function getOutboundMessageContent(payload) {
    if (!payload) return '';
    if (payload.kind === 'text') return payload.body || '';
    if (payload.body && payload.body.body) return payload.body.body;
    return '';
  }

  function describeSystemEvent(entry) {
    const event = entry.event || '';
    if (event === 'provider_created') return 'Conversation started';
    if (event === 'verification_queue_created') return 'Certificate sent for manual verification';
    if (event === 'certificate_verified') return 'Certificate approved by reviewer';
    if (event === 'qualification_corrected_during_certificate_review') {
      return `Qualification corrected during certificate review: ${formatQualification(entry.previousQualification)} to ${formatQualification(entry.approvedQualification)}`;
    }
    if (event === 'certificate_rejected') return 'Certificate rejected by reviewer';
    if (event === 'additional_document_requested') return 'Additional document requested from provider';
    if (event === 'additional_document_received') return 'Requested additional document uploaded';
    if (event === 'agent_help_requested') return 'Provider requested additional help';
    return formatStatus(event || 'system update');
  }

  function renderHistoryBubble(entry) {
    if (!entry) return '';

    if (entry.type === 'inbound_message') {
      const payload = entry.payload || {};
      const content = getInboundMessageContent(payload);
      const messageType = payload.type || 'message';
      const isUpload = ['image', 'document'].includes(messageType);

      return `
        <article class="history-item history-item-inbound">
          <div class="history-meta">
            <span class="history-sender">Provider</span>
            <time>${formatHistoryTime(entry.at)}</time>
          </div>
          <div class="history-bubble">
            ${isUpload ? `<div class="history-label">${messageType === 'document' ? 'Document' : 'Image'}</div>` : ''}
            <div class="history-text">${escapeHtml(content || 'Message received')}</div>
          </div>
        </article>
      `;
    }

    if (entry.type === 'outbound_message') {
      const payload = entry.payload || {};
      const content = getOutboundMessageContent(payload);
      const kind = payload.kind || 'message';

      return `
        <article class="history-item history-item-outbound">
          <div class="history-meta">
            <span class="history-sender">${escapeHtml(entry.sender || 'Bot')}</span>
            <time>${formatHistoryTime(entry.at)}</time>
          </div>
          <div class="history-bubble">
            ${kind !== 'text' ? `<div class="history-label">${escapeHtml(kind)}</div>` : ''}
            <div class="history-text">${escapeHtml(content || 'Message sent')}</div>
          </div>
        </article>
      `;
    }

    return `
      <article class="history-item history-item-system">
        <div class="history-meta">
          <span class="history-sender">System</span>
          <time>${formatHistoryTime(entry.at)}</time>
        </div>
        <div class="history-system-note">${escapeHtml(describeSystemEvent(entry))}</div>
      </article>
    `;
  }

  function buildHistoryHtml(history, emptyMessage) {
    const items = (Array.isArray(history) ? history : []).map(renderHistoryBubble).join('');
    return items || `<p class="attachment-empty">${escapeHtml(emptyMessage || 'No chat history yet.')}</p>`;
  }

  /**
   * Short single-line preview for a chat list row, derived from a history entry.
   * Mirrors what WhatsApp shows under each conversation name.
   */
  function previewFromEntry(entry) {
    if (!entry) return '';
    if (entry.type === 'inbound_message') {
      return getInboundMessageContent(entry.payload) || 'Message received';
    }
    if (entry.type === 'outbound_message') {
      const content = getOutboundMessageContent(entry.payload);
      const sender = entry.sender && entry.sender !== 'bot' ? entry.sender : 'Bot';
      return `${sender}: ${content || 'Message sent'}`;
    }
    return describeSystemEvent(entry);
  }

  global.PulsoChat = {
    escapeHtml,
    formatStatus,
    formatHistoryTime,
    formatQualification,
    getInboundMessageContent,
    getOutboundMessageContent,
    describeSystemEvent,
    renderHistoryBubble,
    buildHistoryHtml,
    previewFromEntry
  };
})(window);
