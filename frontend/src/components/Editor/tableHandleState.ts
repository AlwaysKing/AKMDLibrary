export type TableHeaderHandleType = 'col' | 'row';

export type TableHeaderHandleLock = {
  tableId: string;
  type: TableHeaderHandleType;
  index: number;
} | null;

let headerHandleLock: TableHeaderHandleLock = null;
let headerMenuOpen = false;

export function getHeaderHandleLock(): TableHeaderHandleLock {
  return headerHandleLock;
}

export function setHeaderHandleLock(lock: TableHeaderHandleLock) {
  headerHandleLock = lock;
}

export function clearHeaderHandleLock() {
  headerHandleLock = null;
}

export function isHeaderMenuOpen() {
  return headerMenuOpen;
}

export function setHeaderMenuOpen(isOpen: boolean) {
  headerMenuOpen = isOpen;
}
