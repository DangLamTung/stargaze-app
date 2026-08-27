/**
 * app-reminders.js
 * Stargazing reminders, calendar invites, and notification scheduling.
 */

import {
  createStargazingReminder,
  sendEmailReminder,
  requestNotificationPermission,
  showNotification,
} from '../core/reminder-service.js';
import { showToast } from './toast.js';

function getActiveScores(state) {
  return state.forecastDays === 14 && state.scores14 ? state.scores14 : state.scores;
}

export function setupReminderModal(state) {
  window.openReminder = function (i) {
    const scores = getActiveScores(state);
    if (!scores || !scores[i]) return;
    const night = scores[i];
    const modal = document.getElementById('reminder-modal');
    document.getElementById('reminder-night-date').textContent = new Date(night.date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    document.getElementById('reminder-night-score').textContent = `${night.score}/100`;
    document.getElementById('reminder-night-score').style.color = night.ratingColor;
    document.getElementById('reminder-score-index').value = i;
    modal.classList.add('visible');
  };

  window.addToCalendar = function (i) {
    const scores = getActiveScores(state);
    if (!scores || !scores[i]) return;
    const night = scores[i];
    createStargazingReminder(night, `${state.location.name}, ${state.location.country}`);
    showToast('Calendar event downloaded!', 'success');
  };

  const form = document.getElementById('reminder-form');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const i = parseInt(document.getElementById('reminder-score-index').value, 10);
      const scores = getActiveScores(state);
      const night = scores ? scores[i] : null;
      if (!night) return;
      const email = document.getElementById('reminder-email').value.trim();
      const method = document.querySelector('input[name="reminder-method"]:checked').value;

      if (method === 'email' && email) {
        sendEmailReminder(email, night, `${state.location.name}, ${state.location.country}`);
        showToast('Opening email client', 'success');
      } else if (method === 'notification') {
        if (!('Notification' in window)) {
          showToast('Notifications not supported on this browser', 'error');
          closeReminderModal();
          return;
        }
        if (Notification.permission === 'denied') {
          showToast('Notifications blocked in browser settings', 'error');
          closeReminderModal();
          return;
        }
        const ok = await requestNotificationPermission();
        if (ok) {
          const nightDate = new Date(night.date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
          const weatherInfo = [
            `⭐ ${night.score}/100 ${night.rating}`,
            `☁️ Cloud ${night.avgCloudCover || '?'}%`,
            `🌡️ ${night.tempMin || '?'}°–${night.tempMax || '?'}°C`,
            `👁️ Vis ${((night.avgVisibility || 0) / 1000).toFixed(1)}km`,
            `${night.moonPhaseIcon} Moon ${night.moonPhaseName || '?'}`,
            `📍 ${state.location.name}`,
          ].join(' · ');

          showNotification(`🔭 Stargazing — ${nightDate}`, { body: weatherInfo });

          if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            const now = Date.now();
            const target = new Date(night.sunset).getTime() + 30 * 60000;
            const delay = Math.max(1000, target - now);
            navigator.serviceWorker.controller.postMessage({
              type: 'SCHEDULE',
              delay,
              title: '🔭 Stargazing Tonight!',
              body: weatherInfo,
            });
            showToast('Reminder scheduled for sunset! ✅', 'success');
          } else {
            showToast('Notification set! ✅', 'success');
          }
        }
      }
      closeReminderModal();
    });
  }

  const cancelBtn = document.getElementById('reminder-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeReminderModal);
  }
}

export function closeReminderModal() {
  const modal = document.getElementById('reminder-modal');
  if (modal) modal.classList.remove('visible');
}
