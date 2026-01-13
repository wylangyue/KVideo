import { useEffect, useRef, useState } from 'react';
import { settingsStore } from '@/lib/store/settings-store';
import { fetchSourcesFromUrl, mergeSources } from '@/lib/utils/source-import-utils';

export function useSubscriptionSync() {
    const [subscriptions, setSubscriptions] = useState(() => settingsStore.getSettings().subscriptions);

    // Subscribe to settings changes to detect when subscriptions are updated (e.g. from PasswordGate env sync)
    useEffect(() => {
        const unsubscribe = settingsStore.subscribe(() => {
            const currentSubs = settingsStore.getSettings().subscriptions;
            setSubscriptions(currentSubs);
        });
        return () => unsubscribe();
    }, []);

    // Effect to run the sync when subscriptions change
    useEffect(() => {
        const sync = async () => {
            const activeSubscriptions = subscriptions.filter((s: any) => s.autoRefresh !== false);
            if (activeSubscriptions.length === 0) return;

            // We need to check if we actually need to sync.
            // If we just synced, or if nothing changed, maybe skip?
            // For now, let's rely on a simplified approach:
            // If the subscription list length/content changes, we might want to re-sync.
            // But be careful of infinite loops if we update sources inside this effect.

            const settings = settingsStore.getSettings();
            let anyChanged = false;
            let currentSources = [...settings.sources];
            let currentPremiumSources = [...settings.premiumSources];
            // We use a local copy of subscriptions to avoid re-triggering this effect when we update 'lastUpdated'
            let updatedSubscriptions = [...subscriptions];

            for (let i = 0; i < activeSubscriptions.length; i++) {
                const sub = activeSubscriptions[i];

                // Optional: Check if we synced this recently (e.g. within 5 minutes) to avoid spamming on hot-reload/nav
                // const now = Date.now();
                // if (sub.lastUpdated && now - sub.lastUpdated < 5 * 60 * 1000) continue;

                try {
                    const result = await fetchSourcesFromUrl(sub.url);

                    if (result.normalSources.length > 0) {
                        currentSources = mergeSources(currentSources, result.normalSources);
                        anyChanged = true;
                    }

                    if (result.premiumSources.length > 0) {
                        currentPremiumSources = mergeSources(currentPremiumSources, result.premiumSources);
                        anyChanged = true;
                    }

                    // Update timestamp
                    const subIdx = updatedSubscriptions.findIndex(s => s.id === sub.id);
                    if (subIdx !== -1) {
                        updatedSubscriptions[subIdx] = {
                            ...updatedSubscriptions[subIdx],
                            lastUpdated: Date.now()
                        };
                    }
                } catch (e) {
                    console.error(`Failed to sync subscription: ${sub.name}`, e);
                }
            }

            if (anyChanged) {
                settingsStore.saveSettings({
                    ...settings,
                    sources: currentSources,
                    premiumSources: currentPremiumSources,
                    subscriptions: updatedSubscriptions
                });
            }
        };

        // Debounce slightly to avoid rapid-fire updates if multiple settings change
        const timeoutId = setTimeout(sync, 1000);
        return () => clearTimeout(timeoutId);
    }, [subscriptions]); // Only re-run if subscriptions array reference changes (which happens on saveSettings)
}
