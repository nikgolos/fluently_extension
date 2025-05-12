// Custom tooltip functionality
// More flexible than the native title attribute

class Tooltip {
    constructor() {
        // Create tooltip element
        this.tooltipElement = document.createElement('div');
        this.tooltipElement.className = 'custom-tooltip';
        this.tooltipElement.style.display = 'none';
        document.body.appendChild(this.tooltipElement);
        
        // Track current target element
        this.currentTarget = null;
        
        // Bind event handlers
        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
        this.move = this.move.bind(this);
        
        // Initialize
        this.init();
    }
    
    // Initialize tooltip functionality
    init() {
        // Add CSS styles
        const style = document.createElement('style');
        style.textContent = `
            .custom-tooltip {
                position: fixed;
                background-color: #333;
                color: #fff;
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 15px;
                font-family: 'Google Sans', 'Roboto', sans-serif;
                max-width: 300px;
                z-index: 1000;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            }
            
            .custom-tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                margin-left: -5px;
                border-width: 5px;
                border-style: solid;
                border-color: #333 transparent transparent transparent;
            }
            
            .tooltip-trigger {
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
        
        // Add delegated event listener to the document
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.info-circle-fill-1');
            if (target && target.dataset.tooltip) {
                this.currentTarget = target;
                this.show(target.dataset.tooltip);
                document.addEventListener('mousemove', this.move);
            }
        });
        
        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('.info-circle-fill-1');
            if (target) {
                this.hide();
                document.removeEventListener('mousemove', this.move);
                this.currentTarget = null;
            }
        });
    }
    
    // Show tooltip with given text
    show(text) {
        this.tooltipElement.textContent = text;
        this.tooltipElement.style.display = 'block';
        this.tooltipElement.style.opacity = '1';
    }
    
    // Hide tooltip
    hide() {
        this.tooltipElement.style.opacity = '0';
        setTimeout(() => {
            if (this.tooltipElement.style.opacity === '0') {
                this.tooltipElement.style.display = 'none';
            }
        }, 200);
    }
    
    // Position tooltip near the cursor
    move(e) {
        const x = e.clientX;
        const y = e.clientY;
        
        // Get tooltip dimensions
        const tooltipWidth = this.tooltipElement.offsetWidth;
        const tooltipHeight = this.tooltipElement.offsetHeight;
        
        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate initial position (above the cursor)
        let posX = x - (tooltipWidth / 2);
        let posY = y - tooltipHeight - 10;
        
        // Adjust horizontal position if tooltip would go off-screen
        if (posX < 10) {
            posX = 10; // Keep some margin from the left edge
        } else if (posX + tooltipWidth > viewportWidth - 10) {
            posX = viewportWidth - tooltipWidth - 10; // Keep some margin from the right edge
        }
        
        // Adjust vertical position if tooltip would go off-screen at the top
        if (posY < 10) {
            // Place tooltip below the cursor if not enough space above
            posY = y + 20;
            
            // If still no room, place it in the middle of the viewport height
            if (posY + tooltipHeight > viewportHeight - 10) {
                posY = Math.max(10, Math.min(viewportHeight - tooltipHeight - 10, y - (tooltipHeight / 2)));
            }
        }
        
        // Apply final position
        this.tooltipElement.style.left = `${posX}px`;
        this.tooltipElement.style.top = `${posY}px`;
    }
    
    // Initialize tooltips for a set of elements
    static initTooltips() {
        // Create a single tooltip instance for the page
        if (!window.tooltipInstance) {
            window.tooltipInstance = new Tooltip();
        }
    }
}

// Initialize tooltips on page load
document.addEventListener('DOMContentLoaded', Tooltip.initTooltips); 