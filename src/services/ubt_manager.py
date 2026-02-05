"""UBT (User Behavior Tracking) manager for Trip.com."""

import time
import uuid
from typing import Dict, Any


class UBTManager:
    """Manages UBT tracking IDs and generates UBT-related values."""
    
    def __init__(self, cookies: Dict[str, Any]):
        self.cookies = cookies
    
    def get_ubt_vid(self) -> str:
        """Get or generate UBT visitor ID."""
        return self.cookies.get('UBT_VID', self._generate_ubt_vid())
    
    def get_transaction_id(self) -> str:
        """Get or generate transaction ID."""
        if '_combined' in self.cookies and isinstance(self.cookies['_combined'], dict):
            return self.cookies['_combined'].get('transactionId', self._generate_transaction_id())
        return self._generate_transaction_id()
    
    def get_page_id(self) -> str:
        """Get or generate page ID."""
        if '_combined' in self.cookies and isinstance(self.cookies['_combined'], dict):
            return self.cookies['_combined'].get('pageId', '10320667452')
        return '10320667452'
    
    def get_batch_id(self) -> str:
        """Generate Flt_BatchId (UUID format)."""
        return str(uuid.uuid4())
    
    @staticmethod
    def _generate_ubt_vid() -> str:
        """Generate UBT_VID format: timestamp.randomstring."""
        timestamp = int(time.time() * 1000)
        random_str = uuid.uuid4().hex[:12]
        return f"{timestamp}.{random_str}"
    
    @staticmethod
    def _generate_transaction_id() -> str:
        """
        Generate transaction ID.
        Format: 1-mf-YYYYMMDDHHMMSSmmm-WEB
        """
        from datetime import datetime
        now = datetime.now()
        timestamp = now.strftime('%Y%m%d%H%M%S%f')[:-3]  # YYYYMMDDHHMMSSmmm
        return f"1-mf-{timestamp}-WEB"
    
    def build_ubt_headers(self) -> Dict[str, str]:
        """
        Build UBT-related headers.
        
        Returns:
            Dictionary of UBT headers
        """
        return {
            'x-ctx-ubt-pageid': self.get_page_id(),
            'x-ctx-ubt-pvid': '1',
            'x-ctx-ubt-sid': '1',
            'x-ctx-ubt-vid': self.get_ubt_vid(),
        }
    
    def build_extension_list(self, params: Dict[str, Any], batch_id: str) -> list:
        """
        Build extension list for request head.
        
        Args:
            params: Search parameters
            batch_id: Flight batch ID
            
        Returns:
            List of extension dictionaries
        """
        from datetime import datetime
        
        timestamp = datetime.now().isoformat().replace('Z', '+00:00')
        
        extensions = [
            {'name': 'source', 'value': 'ONLINE'},
            {'name': 'sotpGroup', 'value': 'Trip'},
            {'name': 'sotpLocale', 'value': params.get('locale', 'en-ID')},
            {'name': 'sotpCurrency', 'value': params.get('curr', 'IDR')},
            {'name': 'allianceID', 'value': '0'},
            {'name': 'sid', 'value': '0'},
            {'name': 'ouid', 'value': ''},
            {'name': 'uuid'},
            {'name': 'useDistributionType', 'value': '1'},
            {'name': 'flt_app_session_transactionId', 'value': self.get_transaction_id()},
            {'name': 'vid', 'value': self.get_ubt_vid()},
            {'name': 'pvid', 'value': '1'},
            {'name': 'Flt_SessionId', 'value': '1'},
            {'name': 'channel'},
            {'name': 'x-ua', 'value': 'v=3_os=ONLINE_osv=10'},
            {'name': 'PageId', 'value': self.get_page_id()},
            {'name': 'clientTime', 'value': timestamp},
            {'name': 'LowPriceSource', 'value': params.get('lowpricesource', 'searchForm')},
            {'name': 'Flt_BatchId', 'value': batch_id},
            {'name': 'BlockTokenTimeout', 'value': '0'},
            {'name': 'full_link_time_scene', 'value': 'pure_list_page'},
            {'name': 'xproduct', 'value': 'baggage'},
            {'name': 'units', 'value': 'METRIC'},
            {'name': 'sotpUnit', 'value': 'METRIC'},
        ]
        
        return extensions
