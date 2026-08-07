import { Section, Cell, Image, List } from '@telegram-apps/telegram-ui';
import { type FC, useEffect, useState } from 'react';
import { initData, useSignal } from '@tma.js/sdk-react';

import { Link } from '@/components/Link/Link.tsx';
import { Page } from '@/components/Page.tsx';

import tonSvg from './ton.svg';

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? '';

type AuthResult = {
  userId: number;
  username: string;
  isGuest: boolean;
  telegramId: number;
};

type AuthState =
  | { status: 'loading' }
  | { status: 'success'; result: AuthResult }
  | { status: 'error'; message: string };

export const IndexPage: FC = () => {
  const initDataRaw = useSignal(initData.raw);
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    if (!initDataRaw) {
      setAuthState({
        status: 'error',
        message: '未获取到 Telegram initData，请在 Telegram 内打开本应用',
      });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: initDataRaw }),
        });
        const body = (await res.json().catch(() => ({}))) as AuthResult | { error?: string };
        if (!res.ok || !('userId' in body)) {
          throw new Error(('error' in body && body.error) || `HTTP ${res.status}`);
        }
        if (!cancelled) setAuthState({ status: 'success', result: body as AuthResult });
      } catch (e) {
        if (!cancelled) {
          setAuthState({
            status: 'error',
            message: e instanceof Error ? e.message : '登录失败',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initDataRaw]);

  return (
    <Page back={false}>
      <List>
        <Section header="LingCast Auth Status">
          <Cell>
            {authState.status === 'loading' && '正在通过 Telegram 登录…'}
            {authState.status === 'success' && `✅ 登录成功: ${authState.result.username} (UID: ${authState.result.userId})`}
            {authState.status === 'error' && <span style={{ color: '#ef4444' }}>{authState.message}</span>}
          </Cell>
        </Section>
        <Section
          header="Features"
          footer="You can use these pages to learn more about features, provided by Telegram Mini Apps and other useful projects"
        >
          <Link to="/ton-connect">
            <Cell
              before={<Image src={tonSvg} style={{ backgroundColor: '#007AFF' }}/>}
              subtitle="Connect your TON wallet"
            >
              TON Connect
            </Cell>
          </Link>
        </Section>
        <Section
          header="Application Launch Data"
          footer="These pages help developer to learn more about current launch information"
        >
          <Link to="/init-data">
            <Cell subtitle="User data, chat information, technical data">Init Data</Cell>
          </Link>
          <Link to="/launch-params">
            <Cell subtitle="Platform identifier, Mini Apps version, etc.">Launch Parameters</Cell>
          </Link>
          <Link to="/theme-params">
            <Cell subtitle="Telegram application palette information">Theme Parameters</Cell>
          </Link>
        </Section>
      </List>
    </Page>
  );
};
