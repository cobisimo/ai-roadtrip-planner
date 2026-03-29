import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useHydrateAtoms } from 'jotai/utils'
import { queryClientAtom } from 'jotai-tanstack-query'

const queryClient = new QueryClient()

export const HydrateAtoms = ({ children }: { children: React.ReactNode }) => {
  useHydrateAtoms([[queryClientAtom, queryClient]])
  return children
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HydrateAtoms>
        <App />
      </HydrateAtoms>
    </QueryClientProvider>
  </StrictMode>,
)
