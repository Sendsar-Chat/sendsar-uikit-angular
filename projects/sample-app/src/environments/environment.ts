export type DemoUser = {
  chatUserId: string;
  displayName: string;
};

export const environment = {
  production: false,
  users: [
    { chatUserId: 'usr_shop_1', displayName: 'Alice' },
    { chatUserId: 'usr_shop_2', displayName: 'Bob' },
    { chatUserId: 'usr_shop_3', displayName: 'Shop Support' },
    { chatUserId: 'usr_shop_4', displayName: 'Carol' },
    { chatUserId: 'usr_shop_5', displayName: 'Dave' },
  ] satisfies DemoUser[],
};
