import ipaddr from 'ipaddr.js';

/**
 * Return true for every non-unicast IPv4/IPv6 range, including private,
 * loopback, link-local, multicast, documentation, transition and reserved
 * blocks. ipaddr.js also normalizes IPv4-mapped IPv6 literals before lookup.
 */
export function isPrivateIP(ip: string): boolean {
  const value = ip.trim().replace(/^\[+|\]+$/g, '');
  if (!ipaddr.isValid(value)) return false;
  try {
    return ipaddr.process(value).range() !== 'unicast';
  } catch {
    return false;
  }
}

