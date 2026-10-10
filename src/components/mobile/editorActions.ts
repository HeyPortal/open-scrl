import { buildActions } from '@/app/actions';

/** Leaves the editor for the project list, using the same action as the desktop "Projects" button. */
export function goToProjects() {
  buildActions().find((a) => a.id === 'go-projects')?.run();
}
