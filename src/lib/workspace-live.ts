import { onMounted, onUnmounted, ref } from 'vue';
import { subscribeToChanges } from './atlas/api';

export function useWorkspaceLive(refresh: () => void | Promise<void>) {
    const connection = ref('Connecting');
    let disconnect: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
        if (timer) return;
        timer = setTimeout(() => {
            timer = undefined;
            void refresh();
        }, 300);
    }

    onMounted(() => {
        void refresh();
        disconnect = subscribeToChanges(schedule, () => { connection.value = 'Reconnecting'; }, () => {
            connection.value = 'Live';
            schedule();
        });
    });
    onUnmounted(() => {
        disconnect?.();
        clearTimeout(timer);
    });
    return connection;
}
