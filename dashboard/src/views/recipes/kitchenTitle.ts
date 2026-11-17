// Inside Kitchen, each tab's page title is the row of tabs itself (Kitchen.tsx provides it). Outside,
// e.g. the grocery list on Lists, there's none and the screen keeps its own title.
import { createContext, useContext, type ReactNode } from 'react';

export const KitchenTitle = createContext<ReactNode>(null);
export const useKitchenTitle = (own: ReactNode): ReactNode => useContext(KitchenTitle) ?? own;
