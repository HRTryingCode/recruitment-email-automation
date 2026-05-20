interface GoogleIdCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GoogleIdInitializeConfig {
  client_id: string;
  callback: (response: GoogleIdCredentialResponse) => void;
  auto_select?: boolean;
  use_fedcm_for_prompt?: boolean;
  context?: 'signin' | 'signup' | 'use';
  ux_mode?: 'popup' | 'redirect';
  hd?: string;
}

interface GoogleIdRenderButtonConfig {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number | string;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdInitializeConfig) => void;
  renderButton: (parent: HTMLElement, config: GoogleIdRenderButtonConfig) => void;
  prompt: () => void;
  cancel: () => void;
  disableAutoSelect: () => void;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}
